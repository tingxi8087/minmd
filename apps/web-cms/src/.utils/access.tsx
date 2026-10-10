import { routerAccessData } from "../router/index";
import {
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { Location, NavigateFunction } from "react-router-dom";
import { accessStore } from "@/store/sys";
import { useEffect, useState } from "react";
import { beforePageChange } from "@/router/routerGuard";
import { Spin } from "antd";

export type AccessCode = string | string[] | undefined | null;

export const hasAccess = (code: AccessCode) => {
  if (!code) return true;
  const accessList = accessStore.$?.list || accessStore.list || [];
  const codeList = Array.isArray(code) ? code : [code];
  return codeList.some((item) => accessList.includes(item));
};

export const aceessControll = (location: Location) => {
  const accessName = routerAccessData[location.pathname];
  return hasAccess(accessName);
};
export const aceessValid = (location: Location, navigate: NavigateFunction) => {
  if (!aceessControll(location) && location.pathname != "/403") {
    navigate("/403");
    return false;
  }
  return true;
};
export const wrapRoutesWithAuth = (routes: any) => {
  return routes.map((route: any) => {
    if (route.element) {
      const WithAuth = (props: any) => {
        const navigate = useNavigate();
        const location = useLocation();
        const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(
          null
        );
        const [toPath, setToPath] = useState("/login");
        const verifyAuth = async () => {
          const auth = await beforePageChange(navigate, location);
          if (typeof auth == "string") {
            setToPath(auth);
            setIsAuthenticated(false);
          } else {
            setIsAuthenticated(auth);
          }
        };
        useEffect(() => {
          verifyAuth();
        }, []);
        if (isAuthenticated === null) {
          return (
            <div
              style={{
                height: "calc(100vh - 85px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Spin size="large" />
            </div>
          );
        }
        if (!isAuthenticated && toPath != location.pathname) {
          return <Navigate to={toPath} />;
        }
        return <>{props.children}</>;
      };
      route.element = <WithAuth>{route.element}</WithAuth>;
    }
    if (route.children) {
      route.children = wrapRoutesWithAuth(route.children);
    }
    return route;
  });
};
