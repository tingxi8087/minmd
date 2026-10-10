import { Result } from "antd";
import styles from "./statusPage.module.less";

const Page403 = () => {
  return (
    <div className={styles.page}>
      <Result
        status="403"
        title="403"
        subTitle="对不起，您没有权限访问该页面"
      />
    </div>
  );
};
export default Page403;
