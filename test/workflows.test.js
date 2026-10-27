const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { DatabaseSync } = require("node:sqlite");

let server;
let dataDir;
let baseUrl;
let csrf;
let cookie;
let supplierId;
let customerId;
let productId;
let saleId;

async function unusedPort() {
  const listener=net.createServer();
  await new Promise((resolve,reject)=>listener.listen(0,"127.0.0.1",resolve).once("error",reject));
  const port=listener.address().port;
  await new Promise((resolve)=>listener.close(resolve));
  return port;
}
async function request(route,{method="GET",body,auth=true}={}) {
  const headers={};
  if(body!==undefined)headers["Content-Type"]="application/json";
  if(auth&&cookie)headers.Cookie=cookie;
  if(method!=="GET"&&auth&&csrf)headers["X-CSRF-Token"]=csrf;
  const response=await fetch(`${baseUrl}${route}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  const setCookie=response.headers.get("set-cookie");
  if(setCookie)cookie=setCookie.split(";")[0];
  return {status:response.status,data};
}
async function waitReady() {
  for(let i=0;i<80;i++){
    if(server.exitCode!==null)throw new Error(`server exited with ${server.exitCode}`);
    try {const response=await fetch(`${baseUrl}/api/status`);if(response.ok)return;}
    catch {}
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  throw new Error("server did not start");
}

before(async()=>{
  dataDir=await mkdtemp(path.join(tmpdir(),"medicore-test-"));
  const port=await unusedPort();baseUrl=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,[path.join(__dirname,"..","server.js")],{env:{...process.env,PORT:String(port),HOST:"127.0.0.1",DATA_DIR:dataDir},stdio:"ignore"});
  await waitReady();
});
after(async()=>{
  if(server&&!server.killed){server.kill("SIGTERM");await new Promise((resolve)=>server.once("exit",resolve));}
  if(dataDir)await rm(dataDir,{recursive:true,force:true});
});

test("first-run setup, authenticated batch purchasing, FEFO sales, and balances",async()=>{
  const setup=await request("/api/setup",{method:"POST",auth:false,body:{username:"owner",password:"a-safe-test-password-2026"}});
  assert.equal(setup.status,201);
  assert.equal(setup.data.user.role,"Administrator");
  csrf=setup.data.csrf;
  const status=await fetch(`${baseUrl}/api/status`).then((r)=>r.json());
  assert.equal(status.setupRequired,false);

  const unauthorized=await request("/api/products",{auth:false});
  assert.equal(unauthorized.status,401);
  const supplier=await request("/api/suppliers",{method:"POST",body:{name:"North Pharma",payment_terms:"Net 30"}});
  const customer=await request("/api/customers",{method:"POST",body:{name:"City Medical Store",credit_limit:1000}});
  const product=await request("/api/products",{method:"POST",body:{name:"Paracetamol",brand:"Medi",strength:"500 mg",sale_price:100,reorder_level:2}});
  assert.equal(supplier.status,201);assert.equal(customer.status,201);assert.equal(product.status,201);
  supplierId=supplier.data.id;customerId=customer.data.id;productId=product.data.id;

  const purchase=await request("/api/purchases",{method:"POST",body:{supplier_id:supplierId,invoice_no:"SUP-100",invoice_date:"2026-10-20",paid:0,items:[
    {product_id:productId,batch_no:"B-EARLY",quantity:5,expiry_date:"2027-01-01",purchase_price:10},
    {product_id:productId,batch_no:"B-LATE",quantity:5,expiry_date:"2027-06-01",purchase_price:20},
  ]}});
  assert.equal(purchase.status,201);
  assert.equal(purchase.data.total,150);
  const invalidDate=await request("/api/purchases",{method:"POST",body:{supplier_id:supplierId,invoice_no:"BAD-DATE",items:[
    {product_id:productId,batch_no:"BAD",quantity:1,expiry_date:"2026-02-31",purchase_price:1},
  ]}});
  assert.equal(invalidDate.status,400);

  const sale=await request("/api/sales",{method:"POST",body:{customer_id:customerId,invoice_date:"2026-10-27",paid:0,items:[{product_id:productId,quantity:7,unit_price:100}]}});
  assert.equal(sale.status,201,JSON.stringify(sale.data));
  assert.equal(sale.data.total,700);
  saleId=sale.data.id;
  const detail=await request(`/api/sales/${saleId}`);
  assert.equal(detail.status,200);
  assert.deepEqual(detail.data.items.map((row)=>[row.batch_no,row.quantity]),[["B-EARLY",5],["B-LATE",2]]);
  assert.equal(detail.data.cost_of_goods,90);

  const products=await request("/api/products");
  assert.equal(products.data[0].quantity,3);
  const receipt=await request("/api/payments",{method:"POST",body:{party_type:"customer",direction:"receipt",party_id:customerId,amount:250,method:"Bank transfer"}});
  assert.equal(receipt.status,201);
  const customerRows=await request("/api/customers");
  assert.equal(customerRows.data[0].balance,450);
  const referencedReceipt=await request("/api/payments",{method:"POST",body:{party_type:"customer",direction:"receipt",party_id:customerId,amount:100,reference:"RCPT-100"}});
  assert.equal(referencedReceipt.status,201);
  const duplicateReceipt=await request("/api/payments",{method:"POST",body:{party_type:"customer",direction:"receipt",party_id:customerId,amount:100,reference:"RCPT-100"}});
  assert.equal(duplicateReceipt.status,409);
  assert.equal((await request("/api/customers")).data[0].balance,350);
  const overshoot=await request("/api/payments",{method:"POST",body:{party_type:"customer",direction:"receipt",party_id:customerId,amount:9999}});
  assert.equal(overshoot.status,400);
  const supplierPayment=await request("/api/payments",{method:"POST",body:{party_type:"supplier",direction:"payment",party_id:supplierId,amount:50}});
  assert.equal(supplierPayment.status,201);
  const supplierRows=await request("/api/suppliers");
  assert.equal(supplierRows.data[0].balance,100);

  const duplicate=await request("/api/purchases",{method:"POST",body:{supplier_id:supplierId,invoice_no:"SUP-100",items:[{product_id:productId,batch_no:"DUP",quantity:1,expiry_date:"2027-01-01",purchase_price:1}]}});
  assert.equal(duplicate.status,409);
  const reports=await request("/api/reports?from=2026-10-01&to=2026-10-31");
  assert.equal(reports.status,200);
  assert.equal(reports.data.grossProfit,610);
});

test("expired stock is never sellable and role permissions are enforced",async()=>{
  const database=new DatabaseSync(path.join(dataDir,"medicore.sqlite"));
  database.prepare("UPDATE batches SET expiry_date='2026-01-01' WHERE product_id=? AND batch_no='B-LATE'").run(productId);
  database.close();
  const expiredSale=await request("/api/sales",{method:"POST",body:{customer_id:customerId,paid:0,items:[{product_id:productId,quantity:1,unit_price:100}]}});
  assert.equal(expiredSale.status,400);

  const newUser=await request("/api/users",{method:"POST",body:{username:"store",password:"store-test-password-2026",role:"Storekeeper"}});
  assert.equal(newUser.status,201);
  const loggedOut=await request("/api/logout",{method:"POST"});
  assert.equal(loggedOut.status,200);
  cookie="";csrf="";
  const login=await request("/api/login",{method:"POST",auth:false,body:{username:"store",password:"store-test-password-2026"}});
  assert.equal(login.status,200);
  csrf=login.data.csrf;
  const inventory=await request("/api/products");
  assert.equal(inventory.status,200);
  const forbidden=await request("/api/sales",{method:"POST",body:{items:[{product_id:productId,quantity:1,unit_price:1}]}});
  assert.equal(forbidden.status,403);
});
