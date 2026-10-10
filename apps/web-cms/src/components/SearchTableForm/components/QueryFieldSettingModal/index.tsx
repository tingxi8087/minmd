import React, { useEffect, useRef, useState } from 'react';

import { Button, Checkbox, Modal, Select } from 'antd';
import { CloseOutlined, MenuOutlined } from '@ant-design/icons';

import type { DragEndEvent } from '@dnd-kit/core';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import styles from './index.module.less';

/**
 * 字段配置项（用于"查询表单字段选择"）
 */
export interface QueryFieldItem {
  /** 字段唯一标识 */
  field: string;
  /** 展示名称（建议传 string；若传 ReactNode，仅用于展示，搜索会降级为空） */
  label: React.ReactNode;
  /**
   * 是否为顶部固定字段（始终选中、不可移除、不可拖动）
   * 通常用于"必须展示"的筛选项
   */
  fixedTop?: boolean;
  /**
   * 是否为必选字段（始终选中、不可取消，但可以拖动调整顺序）
   */
  required?: boolean;
}

/**
 * 查询表单字段选择弹窗 Props
 */
export interface QueryFieldSettingModalProps {
  /** 弹窗开关 */
  open: boolean;
  /** 可选字段列表 */
  options: QueryFieldItem[];
  /** 已选字段（有序） */
  value: QueryFieldItem[];
  /** 默认字段（用于“恢复默认”） */
  defaultValue?: QueryFieldItem[];
  /** 取消/关闭 */
  onCancel: () => void;
  /** 确定后回调（返回最新已选字段，包含顺序） */
  onChange: (next: QueryFieldItem[]) => void;
}

/**
 * 取 label 的可搜索文本
 */
function getLabelText(label: React.ReactNode): string {
  if (typeof label === 'string') return label;
  if (typeof label === 'number') return String(label);
  return '';
}

/**
 * 将 value 规范化为：fixedTop 在前，required 字段始终包含，且不重复、且均来自 options
 */
function normalizeSelected(options: QueryFieldItem[], value: QueryFieldItem[]): QueryFieldItem[] {
  const optionMap = new Map(options?.map((it) => [it?.field, it]));
  const seen = new Set<string>();
  const fixedTop = options?.filter((it) => it?.fixedTop);
  const required = options?.filter((it) => it?.required && !it?.fixedTop);
  const result: QueryFieldItem[] = [];

  // 先添加 fixedTop 字段
  fixedTop?.forEach((it) => {
    if (!seen?.has(it?.field)) {
      seen.add(it?.field);
      result.push(it);
    }
  });

  // 然后添加用户选择的字段（保持顺序）
  value?.forEach((it) => {
    const fromOptions = optionMap.get(it?.field);
    if (!fromOptions) return;
    if (seen?.has(fromOptions?.field)) return;
    seen?.add(fromOptions?.field);
    result.push(fromOptions);
  });

  // 最后确保所有 required 字段都被包含（如果还没有的话）
  required?.forEach((it) => {
    if (!seen?.has(it?.field)) {
      seen?.add(it?.field);
      result.push(it);
    }
  });

  return result;
}

/**
 * 可拖拽条目（仅用于"已选字段"列表）
 */
const SortableItem: React.FC<{
  item: QueryFieldItem;
  index: number;
  disableDrag: boolean;
  disableRemove: boolean;
  onRemove: (field: string) => void;
}> = ({ item, index, disableDrag, disableRemove, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item?.field,
    disabled: disableDrag
  });

  const style: React.CSSProperties = {
    transform: CSS?.Translate?.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.selectedRow} ${isDragging ? styles.selectedRowDragging : ''}`}
      {...(disableDrag ? {} : attributes)}
      {...(disableDrag ? {} : listeners)}
    >
      <span className={styles.index}>{index}</span>
      <MenuOutlined className={`${styles.dragHandle} ${disableDrag ? styles.dragHandleDisabled : ''}`} />
      <span className={styles.optionLabel} title={getLabelText(item?.label) || item?.field}>
        {item?.label}
      </span>
      <CloseOutlined
        className={`${styles.remove} ${disableRemove ? styles.removeDisabled : ''}`}
        onClick={() => !disableRemove && onRemove(item?.field)}
      />
    </div>
  );
};

/**
 * 查询表单字段选择弹窗
 */
const QueryFieldSettingModal: React.FC<QueryFieldSettingModalProps> = ({
  open,
  options,
  value,
  defaultValue,
  onCancel,
  onChange
}) => {
  const wasOpen = useRef(false);
  const [selected, setSelected] = useState<QueryFieldItem[]>([]);

  const optionsMap = new Map(options?.map((it) => [it?.field, it]));
  const fixedTopFields = new Set(options?.filter((it) => it?.fixedTop)?.map((it) => it?.field));
  const requiredFields = new Set(options?.filter((it) => it?.required)?.map((it) => it?.field));

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 1 }
    })
  );

  useEffect(() => {
    if (open && !wasOpen.current) setSelected(normalizeSelected(options, value));
    wasOpen.current = open;
  }, [open, options, value]);

  const selectedFieldSet = new Set(selected?.map((it) => it?.field));

  /**
   * 勾选/取消一个字段
   */
  const toggleField = (field: string) => {
    if (fixedTopFields?.has(field) || requiredFields?.has(field)) return;
    const item = optionsMap?.get(field);
    if (!item) return;

    setSelected((prev) => {
      const exists = prev?.some((it) => it?.field === field);
      if (exists) {
        return prev?.filter((it) => it?.field !== field);
      }
      return normalizeSelected(options, [...prev, item]);
    });
  };

  /**
   * Select 多选变化（按 fieldCodes 开关选中）
   */
  const handleSelectChange = (fieldCodes: string[]) => {
    const next = options?.filter((it) => it?.fixedTop || it?.required || fieldCodes.includes(it?.field));

    // 保留原有顺序：fixedTop 先，其他按当前 selected 中的相对顺序，最后补齐新增
    const nextSet = new Set(next?.map((it) => it?.field));
    const ordered: QueryFieldItem[] = [];

    selected?.forEach((it) => {
      if (nextSet?.has(it?.field)) ordered.push(optionsMap?.get(it?.field) || it);
    });
    next.forEach((it) => {
      if (!ordered?.some((x) => x?.field === it?.field)) ordered.push(it);
    });

    setSelected(normalizeSelected(options, ordered));
  };

  /**
   * 移除已选字段
   */
  const removeSelected = (field: string) => {
    if (fixedTopFields?.has(field) || requiredFields?.has(field)) return;
    setSelected((prev) => prev?.filter((it) => it?.field !== field));
  };

  /**
   * 拖拽排序（仅允许移动非 fixedTop 项，且不会插入到 fixedTop 区域内）
   */
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const activeField = String(active?.id);
    const overField = String(over?.id);
    if (activeField === overField) return;
    if (fixedTopFields?.has(activeField) || fixedTopFields?.has(overField)) return;

    setSelected((prev) => {
      const fixedTopPart = prev?.filter((it) => fixedTopFields?.has(it?.field));
      const movable = prev?.filter((it) => !fixedTopFields?.has(it?.field));
      const fromIndex = movable?.findIndex((it) => it?.field === activeField);
      const toIndex = movable?.findIndex((it) => it?.field === overField);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const nextMovable = arrayMove(movable, fromIndex, toIndex);
      return [...fixedTopPart, ...nextMovable];
    });
  };

  /**
   * 恢复默认
   */
  const handleReset = () => {
    const fallback = defaultValue && defaultValue?.length ? defaultValue : value;
    setSelected(normalizeSelected(options, fallback || []));
  };

  /**
   * 确定
   */
  const handleOk = () => {
    onChange(selected);
  };

  const selectedNonFixedTopFields = selected
    ?.filter((it) => !fixedTopFields?.has(it?.field) && !requiredFields?.has(it?.field))
    ?.map((it) => it?.field);

  return (
    <Modal
      title="字段选择"
      open={open}
      onCancel={onCancel}
      width={550}
      footer={[
        <Button key="reset" onClick={handleReset}>
          恢复默认
        </Button>,
        <Button key="ok" type="primary" onClick={handleOk}>
          确定
        </Button>
      ]}
    >
      <div className={styles.modalBody}>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>可选字段</h3>
          <Select
            className={styles.searchSelect}
            mode="multiple"
            placeholder="搜索字段"
            showSearch
            allowClear
            optionFilterProp="label"
            maxTagCount={1}
            value={selectedNonFixedTopFields}
            onChange={handleSelectChange}
            options={options
              ?.filter((it) => !it?.fixedTop && !it?.required)
              ?.map((it) => ({ value: it?.field, label: getLabelText(it?.label) || it?.field }))}
          />

          <div className={styles.listBox}>
            {options?.map((it) => (
              <div key={it?.field} className={styles.optionRow}>
                <Checkbox
                  checked={selectedFieldSet?.has(it?.field)}
                  disabled={!!it?.fixedTop || !!it?.required}
                  onChange={() => toggleField(it?.field)}
                />
                <span className={styles.optionLabel} title={getLabelText(it?.label) || it?.field}>
                  {it?.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>已选字段</h3>
          <Select
            className={styles.searchSelect}
            mode="multiple"
            placeholder="搜索字段"
            showSearch
            allowClear
            optionFilterProp="label"
            maxTagCount={1}
            value={selectedNonFixedTopFields}
            onChange={handleSelectChange}
            options={selected
              ?.filter((it) => !it?.fixedTop && !it?.required)
              ?.map((it) => ({ value: it?.field, label: getLabelText(it?.label) || it?.field }))}
          />

          <DndContext sensors={sensors} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
            <div className={styles.listBox}>
              <SortableContext items={selected?.map((it) => it?.field)} strategy={verticalListSortingStrategy}>
                {selected?.map((it, idx) => (
                  <SortableItem
                    key={it?.field}
                    item={it}
                    index={idx + 1}
                    disableDrag={fixedTopFields?.has(it?.field)}
                    disableRemove={fixedTopFields?.has(it?.field) || requiredFields?.has(it?.field)}
                    onRemove={removeSelected}
                  />
                ))}
              </SortableContext>
            </div>
          </DndContext>
        </div>
      </div>
    </Modal>
  );
};

export default QueryFieldSettingModal;


