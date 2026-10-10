import { Result } from "antd";
import styles from "./statusPage.module.less";

const Page404 = () => {
  return (
    <div className={styles.page}>
      <Result status="404" title="404" subTitle="对不起，您访问的页面不存在" />
    </div>
  );
};
export default Page404;
