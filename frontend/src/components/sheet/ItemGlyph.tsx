/* A tile's little pictogram, chosen by what the thing is. */
import type { InventoryItem } from "../../api/client";
import { IconArmor, IconSack, IconShieldItem, IconSword } from "../ui/icons";
import { itemTypeOf } from "./items";

export default function ItemGlyph({ it }: { it: InventoryItem }) {
  switch (itemTypeOf(it)) {
    case "armor":
      return <IconArmor size={15} strokeWidth={1.6} />;
    case "shield":
      return <IconShieldItem size={15} strokeWidth={1.6} />;
    case "weapon":
      return <IconSword size={15} strokeWidth={1.6} />;
    default:
      return <IconSack size={15} strokeWidth={1.6} />;
  }
}
