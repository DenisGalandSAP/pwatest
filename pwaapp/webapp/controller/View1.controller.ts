import Event from "sap/ui/base/Event";
import Controller from "sap/ui/core/mvc/Controller";

/**
 * @namespace pwaapp.controller
 */
export default class View1 extends Controller {

    /*eslint-disable @typescript-eslint/no-empty-function*/
    public onInit(): void {

    }
    onButtonPress(oEvent: Event): void {
        alert("Button Pressed");
    };
}