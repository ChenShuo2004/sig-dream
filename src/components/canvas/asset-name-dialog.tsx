import { useEffect, useRef, useState } from "react";
import { Input, Modal } from "antd";
import { useTranslation } from "react-i18next";

export function AssetNameDialog({
    open,
    title,
    defaultName,
    okText,
    onCancel,
    onConfirm,
}: {
    open: boolean;
    title: string;
    defaultName: string;
    okText: string;
    onCancel: () => void;
    onConfirm: (name: string) => void;
}) {
    const { t } = useTranslation();
    const [value, setValue] = useState(defaultName);
    const lock = useRef(false);
    useEffect(() => {
        if (open) setValue(defaultName);
    }, [open, defaultName]);

    const confirm = () => {
        if (lock.current) return;
        lock.current = true;
        onConfirm(value.trim());
        window.setTimeout(() => {
            lock.current = false;
        }, 300);
    };

    return (
        <Modal title={title} open={open} centered destroyOnHidden okText={okText} cancelText={t("common.cancel")} onCancel={onCancel} onOk={confirm}>
            <Input value={value} autoFocus maxLength={80} onChange={(event) => setValue(event.target.value)} onPressEnter={confirm} />
        </Modal>
    );
}
