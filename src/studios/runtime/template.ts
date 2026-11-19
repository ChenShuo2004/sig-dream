export type TemplateVars = Record<string, string | number>;

const PLACEHOLDER = /\{\{([a-zA-Z]+)(:number)?\}\}/g;
const WHOLE_NUMBER_PLACEHOLDER = /^\{\{([a-zA-Z]+):number\}\}$/;

export function fillTemplate<T>(value: T, vars: TemplateVars): T {
    if (typeof value === "string") {
        const whole = value.match(WHOLE_NUMBER_PLACEHOLDER);
        if (whole && whole[1] in vars) return Number(vars[whole[1]]) as T;
        return value.replace(PLACEHOLDER, (match, name: string) => (name in vars ? String(vars[name]) : match)) as T;
    }
    if (Array.isArray(value)) return value.map((item) => fillTemplate(item, vars)) as T;
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, fillTemplate(item, vars)])) as T;
    }
    return value;
}
