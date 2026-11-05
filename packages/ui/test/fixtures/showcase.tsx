import {
  Alert, Badge, Button, Checkbox, FieldError, FieldLabel,
  Progress, Separator, Table, TextField
} from "../../src/index.js";
import { signal } from "@zaakiyjs/signals";

export function Showcase() {
  const name = signal("Alice");
  const consent = signal(false);
  return (
    <main class="mx-auto p-8">
      <h1>Zaakiy UI foundation</h1>
      <Button label="Save" tone="primary" onPress={() => { name.value = "Saved"; }} />
      <Badge label="Active" variant="success" />
      <TextField id="name" label="Name" value={name} errorId="name-error" />
      <FieldLabel htmlFor="notes" text="Notes" />
      <FieldError id="name-error" message="Example error" />
      <Checkbox label="I agree" checked={consent} />
      <Progress label="Complete" value={30} max={100} />
      <Separator />
      <Alert message="Your changes were saved" tone="success" />
      <Table caption="Results" headers={["Name"]} rows={[["Alice"]]} />
    </main>
  );
}
