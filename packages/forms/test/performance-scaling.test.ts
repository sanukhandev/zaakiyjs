import {describe, expect, it} from "vitest";
import {createForm} from "../src/index.js";
import type {ValidationIssue} from "../src/index.js";

describe("large cross-field form issue indexing", () => {
  it("preserves duplicate issue order, unregistered paths, and field ownership", async () => {
    const n = 200;
    const names = Array.from({length:n}, (_,i) => "field" + i);
    const values = Object.fromEntries(names.map(name => [name, "value"]));
    const issues: ValidationIssue[] = [
      ...names.flatMap(name => [
        {code:"one",message:"First "+name,path:name,source:"form" as const},
        {code:"two",message:"Second "+name,path:name,source:"form" as const}
      ]),
      {code:"missing",message:"Unknown field",path:"notRegistered",source:"form"},
      {code:"global",message:"Global problem",source:"form"}
    ];
    const form = createForm({initialValues:values,validators:[() => issues]});
    const fields = names.map(name => form.field(name));
    try {
      const result = await form.validate();
      expect(result.status).toBe("invalid");
      expect(result.issues).toEqual(issues);
      expect(form.errors.value).toHaveLength(issues.length);
      for (let i=0;i<fields.length;i++) {
        const fieldIssues = fields[i]!.errors.value;
        expect(fieldIssues.map(issue=>issue.code)).toEqual(["one","two"]);
        expect(fieldIssues.every(issue=>issue.path===names[i])).toBe(true);
      }
      const unassigned = form.errors.value.filter(issue=>!issue.path||issue.path==="notRegistered");
      expect(unassigned.map(issue=>issue.code)).toEqual(["missing","global"]);
      expect((await form.validate()).issues).toEqual(issues);
    } finally {form.dispose();}
  });
  it("does not bypass cancellation or required validation on fast-path fields", async () => {
    const form = createForm({initialValues:{passive:"ok",required:""}});
    try {
      const plain=form.field("passive");
      form.field("required",{required:true});
      const alreadyAborted=new AbortController();
      alreadyAborted.abort("canceled-before-validation");
      expect((await plain.validate({signal:alreadyAborted.signal})).status).toBe("cancelled");
      expect((await form.validate({signal:alreadyAborted.signal})).status).toBe("cancelled");
      const validation=await form.validate();
      expect(validation.status).toBe("invalid");
      expect(validation.issues.some(issue=>issue.path==="required"&&issue.code==="required")).toBe(true);
    } finally {form.dispose();}
  });
});
