from fastapi import APIRouter, FastAPI
from services.orders import create_order, list_orders

app = FastAPI()
router = APIRouter()


@router.get("/orders")
def get_orders():
    return list_orders()


@router.post("/orders")
def post_order():
    return create_order("sku-1")


app.include_router(router)
