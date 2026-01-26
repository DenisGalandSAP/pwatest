import Controller from "sap/ui/core/mvc/Controller";
import UIComponent from "sap/ui/core/UIComponent";
import { Route$MatchedEvent } from "sap/ui/core/routing/Route";
import History from "sap/ui/core/routing/History";
import JSONModel from "sap/ui/model/json/JSONModel";
import ODataModel from "sap/ui/model/odata/v2/ODataModel";
import MessageToast from "sap/m/MessageToast";

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

    public onSave(): void {
        const oModel = this.getView()!.getModel() as ODataModel;
        oModel.submitChanges({
            success: () => {
                MessageToast.show("Changes saved");
                (this.getView()!.getModel("viewModel") as JSONModel).setProperty("/editable", false);
            },
            error: () => {
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
