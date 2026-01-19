import Component from "pwaapp/Component";
import Page from "sap/m/Page";
import Event from "sap/ui/base/Event";
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import { ValueState } from "sap/ui/core/library";

/**
 * @namespace pwaapp.controller
 */
export default class View1 extends Controller {

    /*eslint-disable @typescript-eslint/no-empty-function*/
    public onInit(): void {

        var sAppVersion = (this.getOwnerComponent() as any).getManifestEntry("/sap.app/applicationVersion/version");
        (this.byId("page") as Page).setTitle(sAppVersion);

        const oViewModel = new JSONModel({
            isOnline: navigator.onLine,
            state: navigator.onLine ? "Success" : "Error",
            stateText: navigator.onLine ? "Online" : "Offline",
            icon: navigator.onLine ? "sap-icon://connected" : "sap-icon://disconnected"
        });
        this.getView()?.setModel(oViewModel, "view");

        window.addEventListener("online", this.updateOnlineStatus.bind(this));
        window.addEventListener("offline", this.updateOnlineStatus.bind(this));
    }

    private updateOnlineStatus(): void {
        const bOnline = navigator.onLine;
        const oViewModel = this.getView()?.getModel("view") as JSONModel;
        oViewModel.setProperty("/isOnline", bOnline);
        oViewModel.setProperty("/state", bOnline ? "Success" : "Error");
        oViewModel.setProperty("/stateText", bOnline ? "Online" : "Offline");
        oViewModel.setProperty("/icon", bOnline ? "sap-icon://connected" : "sap-icon://disconnected");
    }

}