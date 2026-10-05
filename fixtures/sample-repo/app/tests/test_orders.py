from app.schemas.order import OrderRequest


def test_order_request_has_customer_id():
    request = OrderRequest(customer_id=1, items=["a"])
    assert request.customer_id == 1
