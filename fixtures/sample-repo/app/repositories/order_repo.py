from app.schemas.order import OrderRequest


class OrderRepository:
    def save(self, payload: OrderRequest):
        return {"id": 1, "customer_id": payload.customer_id}
