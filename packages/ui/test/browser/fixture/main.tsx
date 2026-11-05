import { mount } from "@zaakiyjs/dom";
import { getOwner } from "@zaakiyjs/core";
import { signal } from "@zaakiyjs/signals";
import { createOverlayManager } from "@zaakiyjs/ui-primitives";
import {
  Button, Badge, TextField, Checkbox, Card, Tabs, Dialog,
  DropdownMenu, Tooltip, Popover, Accordion, Table, Alert,
  Pagination, RadioGroup, Switch, Select, Avatar, Skeleton,
  LoadingIndicator, NavigationMenu, Breadcrumbs,
  createToastCenter, BoundTextField
} from "../../../src/index.js";
import { createForm } from "@zaakiyjs/forms";
import "@zaakiyjs/ui/styles.css";

const target = document.getElementById("app");
const toastHost = document.getElementById("toast-host");
if (!target || !toastHost) throw new Error("Missing UI browser acceptance hosts");
const app = target;
const noticeHost = toastHost;

const fieldState = signal("Alice");
const consent = signal(false);
const submitCount = signal(0);
const menuSelection = signal("none");
const form = createForm({
  initialValues: { nickname: "Ada" },
  validateOn: ["change"]
});
const nickname = form.field("nickname", {
  required: true,
  validators: [value => value.length < 2 ? "At least two characters" : null]
});

function Showcase() {
  const owner = getOwner();
  if (!owner) throw new Error("Missing UI fixture owner");
  const overlays = createOverlayManager({ owner, root: app, host: app });
  const toasts = createToastCenter({ owner, host: noticeHost });
  return <main>
    <h1>Zaakiy UI browser acceptance</h1>
    <Button id="save" label="Save" onPress={() => {
      submitCount.value++;
      toasts.announce({ message: "Saved " + submitCount.value, durationMs: 2000 });
    }}/>
    <Button id="disabled" label="Disabled" disabled onPress={() => { submitCount.value++; }}/>
    <Button id="loading" label="Loading" loading onPress={() => { submitCount.value++; }}/>
    <TextField id="customer" label="Customer" value={fieldState} />
    <BoundTextField id="nickname" label="Nickname" field={nickname}/>
    <Checkbox label="Accept terms" checked={consent}/>
    <Badge label="Active" variant="success"/>
    <Card title="Overview" description="Card details"/>
    <Tabs id="account" tabs={[
      {id:"profile",label:"Profile",content:"Profile details"},
      {id:"billing",label:"Billing",content:"Billing details"}
    ]}/>
    <Dialog id="settings" title="Settings" description="Settings dialog"
      triggerLabel="Open Settings" overlays={overlays}/>
    <DropdownMenu id="actions" triggerLabel="Actions" overlays={overlays}
      items={[
        {id:"a",label:"Alpha",onSelect:()=>{menuSelection.value="alpha";}},
        {id:"b",label:"Beta",onSelect:()=>{menuSelection.value="beta";}}
      ]}/>
    <Tooltip id="save-tip" triggerLabel="Help" text="Help tooltip" delayMs={0}/>
    <Popover id="extra" triggerLabel="More" text="More details" overlays={overlays}/>
    <Accordion id="faq" items={[{id:"one",title:"Question",content:"Answer"}]}/>
    <Table caption="Items" headers={["Name"]} rows={[["Alice"]]}/>
    <Alert message="<img src=x onerror=alert(1)>" tone="warning"/>
    <Pagination totalPages={3}/>
    <RadioGroup legend="Plan" name="plan" options={[
      {value:"basic",label:"Basic"},{value:"pro",label:"Pro"}
    ]}/>
    <Switch label="Enabled" defaultValue={false}/>
    <Select id="region" label="Region" options={[
      {value:"ae",label:"United Arab Emirates"},{value:"us",label:"United States"}
    ]}/>
    <Avatar name="Alice Example"/>
    <Skeleton lines={2}/>
    <LoadingIndicator label="Working"/>
    <NavigationMenu label="Main" links={[{label:"Home",href:"/"},{label:"Docs",href:"/docs"}]}/>
    <Breadcrumbs items={[{label:"Home",href:"/"},{label:"UI"}]}/>
  </main>;
}
const handle = mount(() => <div><Showcase/></div>, target);
(window as unknown as {
  __zaakiyUi?: {
    dispose():void;
    getCounts():{saves:number;selection:string;consent:boolean;nickname:string};
    setNickname(value:string):void;
    setCustomer(value:string):void;
    isDisposed():boolean;
  }
}).__zaakiyUi = {
  dispose:()=>{handle.dispose();form.dispose();},
  getCounts:()=>({
    saves:submitCount.value,selection:menuSelection.value,
    consent:consent.value,nickname:nickname.value.value
  }),
  setNickname(value){nickname.value.value=value;},
  setCustomer(value){fieldState.value=value;},
  isDisposed:()=>handle.owner.disposed
};
