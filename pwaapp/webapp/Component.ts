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

        // Bump version to 2 to ensure Schema upgrade triggers if it was stuck at 1
        const request = indexedDB.open(dbName, 2);

        request.onupgradeneeded = (event: any) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };

        request.onsuccess = (event: any) => {
            const db = event.target.result;

            if (model && model.read) {
                model.read("/zi_denuser", {
                    success: (data: any) => {
                        // Reconstruct OData response structure for the SW
                        const wrappedData = {
                            d: {
                                results: data.results || []
                            }
                        };

                        const transaction = db.transaction([storeName], "readwrite");
                        const store = transaction.objectStore(storeName);
                        store.put(wrappedData, requestUrl);
                        console.log("Offline data successfully cached in IndexedDB via ODataModel");
                    },
                    error: (err: any) => {
                        console.error("Offline data fetch via ODataModel failed", err);
                    }
                });
            } else {
                console.warn("OData model not found or invalid");
            }
        };

        request.onerror = (event: any) => {
            console.error("IndexedDB error:", event.target.error);
        };
    }
}