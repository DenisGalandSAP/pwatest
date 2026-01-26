import MessageToast from "sap/m/MessageToast";
import Message from "sap/ui/core/message/Message";
import MessageManager from "sap/ui/core/message/MessageManager";
import { MessageType } from "sap/ui/core/library";

export interface QueueItem {
    id?: number;
    type: "create" | "update" | "delete";
    path: string;
    payload?: any;
    timestamp: number;
}

export default class OfflineQueue {
    private static dbName = "OfflineDB";
    private static storeName = "requestQueue";
    private static dbVersion = 1;
    private static db: IDBDatabase | null = null;
    private static initPromise: Promise<void> | null = null;

    public static async init(): Promise<void> {
        if (this.db) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error("IndexedDB error:", event);
                this.initPromise = null;
                reject(event);
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                resolve();
                // After init, we could restore messages, but let's let the caller decide or do it automatically?
                // For simplicity, we can do it here or provide a method. 
                // Since this is a static helper, let's keep it simple.
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: "id", autoIncrement: true });
                }
            };
        });

        await this.initPromise;
        // Automatically restore messages for existing queue items
        const items = await this.getAllItems();
        this.clearMessages(); // Clear to avoid duplicates if re-init (though it's singleton-ish)
        items.forEach(item => this.addMessage(item));
    }

    public static async addToQueue(type: "create" | "update" | "delete", path: string, payload?: any): Promise<void> {
        await this.init(); // Wait for init to complete

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], "readwrite");
            const store = transaction.objectStore(this.storeName);
            const item: QueueItem = {
                type,
                path,
                payload,
                timestamp: Date.now()
            };

            const request = store.add(item);

            request.onsuccess = () => {
                this.addMessage(item); // Add to UI Message Manager
                MessageToast.show("Action queued (Offline)");
                resolve();
            };

            request.onerror = (event) => {
                reject(event);
            };
        });
    }

    public static async getAllItems(): Promise<QueueItem[]> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result as QueueItem[]);
            };

            request.onerror = (event) => {
                reject(event);
            };
        });
    }

    public static async removeItem(id: number): Promise<void> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], "readwrite");
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = (event) => {
                reject(event);
            };
        });
    }

    // Helper to manage UI messages
    private static addMessage(item: QueueItem): void {
        const oMessageManager = sap.ui.getCore().getMessageManager();
        const sMessage = `Offline Action: ${item.type.toUpperCase()} - ${item.path}`;

        // We use the timestamp as a pseudo-target or identifier if needed, 
        // but for now simple text is enough.
        const oMessage = new Message({
            message: sMessage,
            description: `Queued action for ${item.path}`,
            type: MessageType.Warning,
            target: "", // No specific target control
            processor: null as any // Global message
        });

        oMessageManager.addMessages(oMessage);
    }

    public static clearMessages(): void {
        const oMessageManager = sap.ui.getCore().getMessageManager();
        oMessageManager.removeAllMessages();
    }
}
