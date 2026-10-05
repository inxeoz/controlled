from pydantic import BaseModel


class OrderRequest(BaseModel):
    customer_id: int
    items: list[str]
    note: str | None = None
