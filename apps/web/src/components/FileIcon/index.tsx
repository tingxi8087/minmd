import {
  FileText,
  Folder,
  Presentation,
  Table2,
  FileType2,
  Image,
  Video,
} from "lucide-react";
import { FileKind } from "@/store/workspace";
import styles from "./index.module.less";
export default function FileIcon({
  kind,
  small = false,
}: {
  kind: FileKind;
  small?: boolean;
}) {
  const Icon = {
    doc: FileText,
    sheet: Table2,
    slide: Presentation,
    folder: Folder,
    pdf: FileType2,
    video: Video,
    image: Image,
  }[kind];
  return (
    <span
      className={`${styles.icon} ${small ? styles.small : ""}`}
      data-kind={kind}
    >
      <Icon size={small ? 17 : 21} strokeWidth={1.7} />
    </span>
  );
}
