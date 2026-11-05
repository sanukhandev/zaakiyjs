import { describe,expect,it } from "vitest";
import {buttonClasses,badgeClasses} from "../src/recipes.js";
describe("static Zaakiy UI recipes",()=>{
  it("enumerates contract tone, appearance and size without style compiler",()=>{
    for(const tone of ["primary","neutral","danger"] as const)
      for(const appearance of ["solid","outline","ghost"] as const)
        for(const size of ["sm","md","lg"] as const)
          expect(buttonClasses(tone,appearance,size)).toBe(
            "zui-button zui-button--"+size+" zui-button--"+tone+" zui-button--"+appearance
          );
  });
  it("deduplicates exact named classes deterministically",()=>{
    expect(buttonClasses("primary","solid","md","custom custom zui-button")).toBe(
      "zui-button zui-button--md zui-button--primary zui-button--solid custom"
    );
  });
  it("supports badge variants",()=>{expect(badgeClasses("success")).toBe("zui-badge zui-badge--success");});
});
