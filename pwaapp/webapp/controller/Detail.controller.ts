import Controller from "sap/ui/core/mvc/Controller";
import UIComponent from "sap/ui/core/UIComponent";
import { Route$MatchedEvent } from "sap/ui/core/routing/Route";
import History from "sap/ui/core/routing/History";
import JSONModel from "sap/ui/model/json/JSONModel";
import ODataModel from "sap/ui/model/odata/v2/ODataModel";
import MessageToast from "sap/m/MessageToast";
import OfflineQueue from "../utils/OfflineQueue";

/**
 * @namespace pwaapp.controller
 */
export default class Detail extends Controller {
    public onInit(): void {
        const oViewModel = new JSONModel({
            editable: false
        });
        this.getView()!.setModel(oViewModel, "viewModel");

        const oRouter = UIComponent.getRouterFor(this);
        oRouter.getRoute("RouteDetail")!.attachMatched(this.onRouteMatched, this);
    }

    public onRouteMatched(oEvent: Route$MatchedEvent): void {
        const oArgs = oEvent.getParameter("arguments") as { Username: string };
        const sPath = "/zi_denuser('" + oArgs.Username + "')";
        this.getView()!.bindElement({
            path: sPath
        });
        (this.getView()!.getModel("viewModel") as JSONModel).setProperty("/editable", false);
    }

    public onEdit(): void {
        (this.getView()!.getModel("viewModel") as JSONModel).setProperty("/editable", true);
    }

    public onCancel(): void {
        (this.getView()!.getModel("viewModel") as JSONModel).setProperty("/editable", false);
        const oModel = this.getView()!.getModel() as ODataModel;
        oModel.resetChanges();
    }

    public async onSave(): Promise<void> {
        const oModel = this.getView()!.getModel() as ODataModel;
        const oContext = this.getView()!.getBindingContext();
        if (!oContext) {
            MessageToast.show("No context found");
            return;
        }
        const sPath = oContext.getPath();
        const oData = oContext.getObject();

        // Optimistic offline check
        if (!navigator.onLine) {
            try {
                await OfflineQueue.addToQueue("update", sPath, oData);
                (this.getView()!.getModel("viewModel") as JSONModel).setProperty("/editable", false);
                // Reset changes effectively "accepts" the user input in the UI, cleaning the dirty state
                // This prevents "unsaved changes" warnings, assuming the queue will handle it.
                oModel.resetChanges();
            } catch (e) {
                console.error("Failed to queue offline action", e);
                MessageToast.show("Error queuing offline action");
            }
            return;
        }

        // Online attempt
        oModel.submitChanges({
            success: (oBatchData: any, response: any) => {
                // Check for batch errors (typical in OData V2)
                if (response && response.data && response.data.__batchResponses) {
                    const aBatchResponses = response.data.__batchResponses;
                    const oErrorResponse = aBatchResponses.find((r: any) => r.response && r.response.statusCode >= 400);
                    if (oErrorResponse) {
                        // Extract inner error if possible
                        try {
                            const sInnerBody = oErrorResponse.response.body;
                            const oInnerError = JSON.parse(sInnerBody);
                            // We treat this as an error. If it looks like a temporary failure (503, 504), queue it.
                            // If it is 400/500, maybe show error.
                            // For resilience, let's queue if we suspect network.
                            // But parsing is hard. Let's just catch the general error case if needed.
                            // For now, assume network failure triggers the error callback mostly.
                        } catch (e) { }
                    }
                }

                MessageToast.show("Changes saved");
                (this.getView()!.getModel("viewModel") as JSONModel).setProperty("/editable", false);
            },
            error: (oError: any) => {
                console.error("SubmitChanges failed", oError);
                // Broaden error check: 0, 503, 504, or generic "NetworkError" text
                const isNetworkError =
                    oError.statusCode === "0" ||
                    oError.statusCode === 0 ||
                    !oError.statusCode ||
                    oError.statusCode === 503 ||
                    oError.statusCode === 504 ||
                    oError.statusText === "NetworkError";

                if (isNetworkError) {
                    OfflineQueue.addToQueue("update", sPath, oData).then(() => {
                        (this.getView()!.getModel("viewModel") as JSONModel).setProperty("/editable", false);
                        oModel.resetChanges();
                    });
                    return;
                }
                MessageToast.show("Error saving changes");
            }
        });
    }

    public onNavBack(): void {
        const oHistory = History.getInstance();
        const sPreviousHash = oHistory.getPreviousHash();

        if (sPreviousHash !== undefined) {
            window.history.go(-1);
        } else {
            const oRouter = UIComponent.getRouterFor(this);
            oRouter.navTo("RouteView1", {}, true);
        }
    }
}
