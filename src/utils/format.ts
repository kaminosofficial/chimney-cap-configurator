export function formatFrac(val: number): string {
    const whole = Math.floor(val);
    const frac = val - whole;
    if (frac === 0) return whole === 0 ? '0' : whole.toString();

    const eighths = Math.ceil(frac * 8);
    if (eighths === 0) return whole === 0 ? '0' : whole.toString();
    if (eighths === 8) return (whole + 1).toString();

    const fracStrs = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
    return whole > 0 ? `${whole} ${fracStrs[eighths]}` : fracStrs[eighths];
}
