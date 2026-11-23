import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    autoSend: {
        type: OptionType.BOOLEAN,
        description: "Immediately send captioned files. If disabled, they're attached for you to send manually.",
        default: true
    }
});
