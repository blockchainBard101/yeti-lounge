const owner = "0xe4a8fd09bc182ea3e84014547a1f9832307eaab17446e067d638bd45171cc983";
const coinType = "0xcebb6563df9fb7b59833da4bfc96dce11e3600e71e6b5e930ee1be82914dfa98::lofi::LOFI";

async function run() {
  const res = await fetch("https://fullnode.testnet.sui.io", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "suix_getCoins",
        params: [owner, coinType]
      }),
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}
run();
