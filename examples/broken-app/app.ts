async function loadOrders(path: string) {
  await domo.get("/data/v1/unknown-orders");
  return domo.get(path);
}

const appdbNote = "AppDB collection setup requires Domo-side verification";
void [loadOrders, appdbNote];
