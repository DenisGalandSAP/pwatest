import Component from "pwaapp/Component";
import Page from "sap/m/Page";
import Event from "sap/ui/base/Event";
import Controller from "sap/ui/core/mvc/Controller";

/**
 * @namespace pwaapp.controller
 */
export default class View1 extends Controller {

    /*eslint-disable @typescript-eslint/no-empty-function*/
    public onInit(): void {

        var sAppVersion = (this.getOwnerComponent() as any).getManifestEntry("/sap.app/applicationVersion/version");
        (this.byId("page") as Page).setTitle(sAppVersion);

    }
    onButtonPress(oEvent: Event): void {
        alert("Button Pressed");
    };
}