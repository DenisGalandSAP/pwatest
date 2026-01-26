import BaseComponent from "sap/ui/core/UIComponent";
import { createDeviceModel } from "./model/models";
import ODataModel from "sap/ui/model/odata/v2/ODataModel";

/**
 * @namespace pwaapp
 */
export default class Component extends BaseComponent {

    public static metadata = {
        manifest: "json",
        interfaces: [
            "sap.ui.core.IAsyncContentCreation"
        ]
    };

    public init(): void {
        // call the base component's init function
        super.init();

        // set the device model
        this.setModel(createDeviceModel(), "device");

        // enable routing
        this.getRouter().initialize();

        // Initialize offline data with a slight delay to ensure models are ready
        setTimeout(() => {
            this._initOfflineData(this.getModel() as ODataModel);
        }, 1000);
    }

    private _initOfflineData(model: ODataModel): void {
        const dbName = "pwaapp-db";
        const storeName = "odata-store";
        const requestUrl = "/sap/opu/odata/sap/ZGP_DENUSER_SRV/zi_denuser";

        // Bump version to 3 to ensure we can recreate the store with correct options if needed
        const request = indexedDB.open(dbName, 4);

        request.onupgradeneeded = (event: any) => {
            const db = event.target.result;
            // Delete existing store to ensure we create it with out-of-line keys (no keyPath)
            if (db.objectStoreNames.contains(storeName)) {
                db.deleteObjectStore(storeName);
            }
            db.createObjectStore(storeName);
        };

        request.onsuccess = (event: any) => {
            const db = event.target.result;

            // Check if store exists; create transaction to check count
            if (!db.objectStoreNames.contains(storeName)) {
                return;
            }

            const countTransaction = db.transaction([storeName], "readonly");
            const countStore = countTransaction.objectStore(storeName);
            const countRequest = countStore.count();

            countRequest.onsuccess = () => {
                if (countRequest.result > 0) {
                    console.log(`IndexedDB '${storeName}' is already populated. Skipping offline data fetch.`);
                    return;
                }

                console.log(`IndexedDB '${storeName}' is empty. Initializing offline data...`);

                if (model && model.read) {
                    model.read("/zi_denuser", {
                        success: (data: any) => {
                            // Ensure data is cloneable by stripping UI5 metadata/prototypes
                            // This prevents DataCloneError in IndexedDB
                            const cleanData = JSON.parse(JSON.stringify(data));

                            // Handle both { results: [...] } and direct array response
                            const results = Array.isArray(cleanData) ? cleanData : (cleanData.results || []);

                            // Reconstruct OData response structure for the SW
                            const wrappedData = {
                                d: {
                                    results: results
                                }
                            };

                            const transaction = db.transaction([storeName], "readwrite");
                            const store = transaction.objectStore(storeName);

                            // Explicitly handle the put request result
                            const putRequest = store.put(wrappedData, requestUrl);

                            putRequest.onsuccess = () => {
                                console.log("[Component] Offline cache updated from network data (IndexedDB)");

                                putRequest.onerror = (e: any) => {
                                    console.error("Failed to put data in IndexedDB:", e.target.error);
                                };

                                transaction.oncomplete = () => {
                                    // Transaction finished
                                };

                                transaction.onerror = (e: any) => {
                                    console.error("IndexedDB Transaction error:", e.target.error);
                                };
                            };
                        },
                        error: (err: any) => {
                            console.error("Offline data fetch via ODataModel failed", err);
                        }
                    });
                } else {
                    console.warn("OData model not found or invalid");
                }
            };
        };

        request.onerror = (event: any) => {
            console.error("IndexedDB error:", event.target.error);
        };
    }
}