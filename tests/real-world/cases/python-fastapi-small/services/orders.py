def list_orders() -> list[str]:
    return ["sku-1"]


def create_order(sku: str) -> dict[str, str]:
    return {"sku": sku, "status": "created"}
