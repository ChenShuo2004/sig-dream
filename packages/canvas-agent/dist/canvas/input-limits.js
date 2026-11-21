/** Reject oversized or excessively nested inputs before schema validation or canvas dispatch. */
export function assertBoundedInput(value) {
    const pending = [{ value, depth: 0 }]; let fields = 0;
    while (pending.length) {
        const item = pending.pop();
        if (++fields > 20000 || item.depth > 32) throw new Error("Tool input exceeds complexity limit");
        if (typeof item.value === "string" && item.value.length > 2 * 1024 * 1024) throw new Error("Tool string exceeds size limit");
        if (item.value && typeof item.value === "object") {
            if (Array.isArray(item.value) && item.value.length > 1000) throw new Error("Tool collection exceeds 1000 items");
            for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
        }
    }
}
