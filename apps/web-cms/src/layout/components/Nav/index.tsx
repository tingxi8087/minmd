import { layoutConfig } from "../../layoutConfig";
import PersonMenu from "../PersonMenu";
import styles from "./index.module.less";

export default function Nav() {
  return (
    <div className={styles.nav} style={{ height: layoutConfig.navHeight }}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>
          {layoutConfig.NAV_NAME.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.brandText}>{layoutConfig.NAV_NAME}</span>
      </div>
      <div>
        <PersonMenu />
      </div>
    </div>
  );
}
