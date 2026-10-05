from app.repositories.order_repo import OrderRepository
from app.schemas.order import OrderRequest


class OrderService:
    def __init__(self):
        self.repo = OrderRepository()

    def create_order(self, payload: OrderRequest):
        validated = self.validate(payload)
        return self.repo.save(validated)

    def validate(self, payload: OrderRequest):
        if payload.customer_id is None:
            raise ValueError("customer_id is required")
        return payload
