async function loadSales() {
  return domo.get("/data/v1/sales");
}

void loadSales;
