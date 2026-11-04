import { signal } from "@zaakiyjs/core";
import { mount } from "@zaakiyjs/dom";

const clicks = signal(0);
mount(() => <button class="flex gap-4" onClick={() => clicks.value++}>
  Count: {clicks.value}
</button>, document.getElementById("app")!);
