from fastapi import APIRouter, Depends
from app.schemas.order import OrderRequest
from app.services.order_service import OrderService

router = APIRouter()


@router.post("/orders")
def create_order_endpoint(payload: OrderRequest, service: OrderService = Depends()):
    return service.create_order(payload)
