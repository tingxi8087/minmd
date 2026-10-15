import { layoutConfig, NAV_LOGO } from "../../layoutConfig";
import PersonMenu from "../PersonMenu";
import styles from "./index.module.less";

export default function Nav() {
  return (
    <div className={styles.nav} style={{ height: layoutConfig.navHeight }}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>
          <img src={NAV_LOGO} alt="" aria-hidden="true" />
        </span>
        <span className={styles.brandText}>{layoutConfig.NAV_NAME}</span>
      </div>
      <div>
        <PersonMenu />
      </div>
    </div>
  );
}
