let resolveAssetUrl = (id: string) => `/api/app/assets/${id}`;
export const assetUrl = (id: string) => resolveAssetUrl(id);
export function configureAssetUrl(resolver: (id: string) => string) {
  resolveAssetUrl = resolver;
}
