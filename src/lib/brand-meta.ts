import shareAsset from "@/assets/live-teka-share.jpg.asset.json";
import { SITE_DESCRIPTION, SITE_NAME, SITE_OFFICIAL_NAME, SITE_URL } from "@/lib/site";

type MetaTag = { title?: string; name?: string; property?: string; content?: string };
export const BRAND_SHARE_IMAGE = `${SITE_URL}${shareAsset.url}`;

const replaceOldName = (value: string) =>
  value.replace(/Live\s*Market(?:place)?/gi, SITE_OFFICIAL_NAME);

/** Completes each leaf's metadata without changing its content, URL or indexing rules. */
export function brandMeta(tags: MetaTag[], preserveContentImage = false): MetaTag[] {
  const contentImage = preserveContentImage
    ? tags.find((tag) => tag.property === "og:image" && tag.content?.startsWith("https://"))?.content
    : undefined;
  const image = contentImage ?? BRAND_SHARE_IMAGE;
  const clean = tags.filter((tag) => !["og:image", "twitter:image"].includes(tag.property ?? tag.name ?? ""))
    .map((tag) => ({ ...tag, ...(tag.content ? { content: replaceOldName(tag.content) } : {}) }));
  const original = replaceOldName(clean.find((tag) => tag.title)?.title ?? SITE_OFFICIAL_NAME);
  const pageName = original.replace(/\s*[—–·]\s*Live Teká.*$/i, "").trim();
  const title = original === SITE_OFFICIAL_NAME || pageName === SITE_NAME
    ? SITE_OFFICIAL_NAME : `${pageName} — ${SITE_OFFICIAL_NAME}`;
  const existingDescription = clean.find((tag) => tag.name === "description")?.content;
  const description = existingDescription
    ? (existingDescription.includes(SITE_NAME) ? existingDescription : `${existingDescription} ${SITE_OFFICIAL_NAME}.`)
    : `${pageName} na ${SITE_OFFICIAL_NAME}.`;
  const reserved = new Set(["description", "og:title", "og:description", "og:site_name", "twitter:title", "twitter:description", "twitter:card"]);
  const rest = clean.filter((tag) => !tag.title && !reserved.has(tag.name ?? tag.property ?? ""));
  return [
    ...rest,
    { title },
    { name: "description", content: description || SITE_DESCRIPTION },
    { property: "og:title", content: title },
    { property: "og:description", content: description || SITE_DESCRIPTION },
    { property: "og:site_name", content: SITE_OFFICIAL_NAME },
    ...(!rest.some((tag) => tag.property === "og:type") ? [{ property: "og:type", content: "website" }] : []),
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description || SITE_DESCRIPTION },
    { property: "og:image", content: image },
    ...(!contentImage ? [
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Logótipo oficial Live Teká sobre fundo verde" },
      { name: "twitter:image:alt", content: "Logótipo oficial Live Teká sobre fundo verde" },
    ] : []),
    { name: "twitter:image", content: image },
  ];
}