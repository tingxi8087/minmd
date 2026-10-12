/** 重试保留同一文件及首次写入基线，冲突时由用户明确选择覆盖。 */
export type PendingImport = {
  file: File;
  userId: string;
  spaceId: string;
  createdId?: string;
  basis?: { revision: number; epoch: number };
};
export async function saveImportedContent<T>(
  task: PendingImport,
  projection: T,
  dependencies: {
    assertActive: () => void;
    create: () => Promise<string>;
    content: (id: string) => Promise<{ revision: number; epoch: number }>;
    confirmReplace: () => Promise<boolean>;
    write: (
      id: string,
      projection: T,
      revision: number,
      epoch: number,
    ) => Promise<unknown>;
  },
): Promise<string> {
  const { assertActive } = dependencies;
  assertActive();
  if (!task.createdId) task.createdId = await dependencies.create();
  assertActive();
  const basis = await dependencies.content(task.createdId);
  assertActive();
  if (
    task.basis &&
    (task.basis.revision !== basis.revision || task.basis.epoch !== basis.epoch)
  ) {
    if (!(await dependencies.confirmReplace()))
      throw new Error("已取消覆盖，原导入文件仍保留");
    assertActive();
  }
  task.basis = { revision: basis.revision, epoch: basis.epoch };
  await dependencies.write(
    task.createdId,
    projection,
    basis.revision,
    basis.epoch,
  );
  assertActive();
  return task.createdId;
}
