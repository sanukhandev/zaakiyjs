import type {StyleConfig} from "@zaakiyjs/styles";
export default {
  brand: {
    identity:{name:"__BRAND_NAME__",slug:"__PROJECT_NAME__"},
    colors:{primary:"__PRIMARY_COLOR__",foreground:"#182033",background:"#ffffff",surface:"#f8fafc",border:"#cbd5e1"},
    spacing:{"2":"0.5rem","4":"1rem","6":"1.5rem","8":"2rem"},
    fonts:{sans:"system-ui, sans-serif"},
    radii:{md:"__RADIUS_VALUE__"},
    appearance:{dark:{colors:{background:"#111827",foreground:"#f8fafc",surface:"#1f2937",border:"#4b5563"}}}
  },
  mode:"__APPEARANCE__"
} satisfies StyleConfig;
