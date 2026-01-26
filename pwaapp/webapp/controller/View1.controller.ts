import Page from "sap/m/Page";
import Event from "sap/ui/base/Event";
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import UIComponent from "sap/ui/core/UIComponent";
import Dialog from "sap/m/Dialog";
import Button from "sap/m/Button";
import Label from "sap/m/Label";
import Input from "sap/m/Input";
import SimpleForm from "sap/ui/layout/form/SimpleForm";
import ODataModel from "sap/ui/model/odata/v2/ODataModel";
import MessageToast from "sap/m/MessageToast";
import Table from "sap/m/Table";
import { DialogType, ButtonType } from "sap/m/library";

/**
 * @namespace pwaapp.controller
 */
export default class View1 extends Controller {
    private _pCreateDialog: Promise<Dialog> | null = null;
    private _oCreateModel: JSONModel | null = null;

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

    public onListItemPress(oEvent: Event): void {
        //@ts-expect-error no error
        const oItem = oEvent.getParameter("listItem") as any;
        const oBindingContext = oItem.getBindingContext();
        const sUsername = oBindingContext.getProperty("Username");

        UIComponent.getRouterFor(this).navTo("RouteDetail", {
            Username: sUsername
        });
    }

    public onDelete(): void {
        const oTable = this.byId("table") as Table;
        const oItem = oTable.getSelectedItem();
        if (!oItem) {
            MessageToast.show("Please select a user to delete");
            return;
        }

        const sPath = oItem.getBindingContext()!.getPath();
        const oModel = this.getView()!.getModel() as ODataModel;

        oModel.remove(sPath, {
            success: () => {
                MessageToast.show("User deleted");
            },
            error: () => {
                MessageToast.show("Error deleting user");
            }
        });
    }

    public onCreate(): void {
        if (!this._pCreateDialog) {
            this._oCreateModel = new JSONModel({
                Name: "",
                Hobbies: 0
            });

            this._pCreateDialog = new Promise((resolve) => {
                const oDialog = new Dialog({
                    title: "Create User",
                    type: DialogType.Message,
                    content: new SimpleForm({
                        editable: true,
                        content: [
                            new Label({ text: "Name" }),
                            new Input({ value: "{create>/Name}" }),
                            new Label({ text: "Hobbies" }),
                            new Input({ value: "{create>/Hobbies}", type: "Number" })
                        ]
                    }),
                    beginButton: new Button({
                        type: ButtonType.Emphasized,
                        text: "Create",
                        press: () => {
                            this._createUser(oDialog);
                        }
                    }),
                    endButton: new Button({
                        text: "Cancel",
                        press: () => {
                            oDialog.close();
                        }
                    })
                });
                oDialog.setModel(this._oCreateModel!, "create");
                this.getView()!.addDependent(oDialog);
                resolve(oDialog);
            });
        }

        this._pCreateDialog.then((oDialog) => {
            this._oCreateModel!.setData({ Username: "", Name: "", Hobbies: 0 });
            oDialog.open();
        });
    }

    private _createUser(oDialog: Dialog): void {
        const oData = this._oCreateModel!.getData();
        // Ensure Hobbies is an integer as Input binding might convert it to string
        if (oData.Hobbies) {
            oData.Hobbies = parseInt(oData.Hobbies, 10);
        }
        const oModel = this.getView()!.getModel() as ODataModel;

        oModel.create("/zi_denuser", oData, {
            success: () => {
                MessageToast.show("User created");
                debugger;
                oDialog.close();
            },
            error: () => {
                MessageToast.show("Error creating user");
                debugger;
            }
        });
    }

}