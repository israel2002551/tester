/**
 * What a buyer chose for an order line: a size, which photo ("option N"),
 * and a short note. The browser asks for these before checkout
 * (src/lib/productChoices.js); the server only cleans them, turns the option
 * number into the product's photo, and stores them on the order so the
 * seller knows exactly what to send.
 */
export type OrderChoice = {
  qty: number;
  size: string;
  option: number | null;
  option_image: string;
  note: string;
};

function cleanText(value: unknown, max: number, pattern: RegExp) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(pattern, "").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

/** Cleans one cart line's choices; null when the buyer chose nothing. */
export function cleanOrderChoice(input: unknown, qty: number): OrderChoice | null {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const size = cleanText(raw.size, 30, /[<>"`\\]/g);
  const optionNumber = Math.trunc(Number(raw.option));
  const option = optionNumber >= 1 && optionNumber <= 30 ? optionNumber : null;
  const note = cleanText(raw.note, 200, /[<>`\\]/g);
  if (!size && !option && !note) return null;
  return { qty, size, option, option_image: "", note };
}

/**
 * The listing's photos in the order buyers see them (main photo first, no
 * repeats): the same list as photoOptions in src/lib/productChoices.js, so
 * "option 2" is the same photo on both sides.
 */
export function photoOptionsFor(product: { image_url?: unknown; images?: unknown }) {
  const images = Array.isArray(product.images) ? product.images : [];
  const ordered = [product.image_url, ...images]
    .map((url) => (typeof url === "string" ? url.trim() : ""))
    .filter(Boolean);
  return ordered.filter((url, index) => ordered.indexOf(url) === index);
}

/** Fills in each choice's photo; an option the listing does not have is dropped. */
export function resolveOrderChoices(choices: OrderChoice[], photos: string[]): OrderChoice[] {
  return choices.map((choice) => {
    const photo = choice.option ? photos[choice.option - 1] || "" : "";
    return photo
      ? { ...choice, option_image: photo.slice(0, 1_500) }
      : { ...choice, option: null, option_image: "" };
  }).filter((choice) => choice.size || choice.option || choice.note);
}

/** "Size 40 · Option 2 · wine colour" for one choice. */
export function choiceLabel(choice: Pick<OrderChoice, "size" | "option" | "note">) {
  const parts: string[] = [];
  if (choice.size) parts.push(`Size ${choice.size}`);
  if (choice.option) parts.push(`Option ${choice.option}`);
  if (choice.note) parts.push(choice.note);
  return parts.join(" · ");
}

/**
 * One line for every choice of a product: "Size 40 · Option 2", or
 * "1 × Size 40; 2 × Size 42" when the buyer took several.
 */
export function choiceSummary(choices: OrderChoice[] | null | undefined, totalQty?: number) {
  const list = (choices || []).filter((choice) => choiceLabel(choice));
  if (!list.length) return "";
  if (list.length === 1 && (!totalQty || list[0].qty === totalQty)) return choiceLabel(list[0]);
  return list.map((choice) => `${choice.qty} × ${choiceLabel(choice)}`).join("; ");
}
