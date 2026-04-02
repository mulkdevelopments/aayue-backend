module.exports.generateOrderStatusEmail = ({
  customerName,
  orderId,
  items,
  status, // processing, shipped, delivered, cancelled
  currency = "€",
  duty_percent = 0,
}) => {
  console.log(
    customerName,
    orderId,
    items,
    status,
    "Generating order status email"
  );
  if (
    !customerName ||
    !orderId ||
    !Array.isArray(items) ||
    items.length === 0 ||
    !status
  ) {
    throw new Error(
      "Missing required parameters: customerName, orderId, items, status"
    );
  }

  // STATUS BASED MESSAGES
  const STATUS_MESSAGES = {
    processing: {
      title: "Your order is now being processed!",
      message: `Dear <span class='orange-clr'>${customerName}</span>,<br class='color-white'>Your order <span class='orange-clr'>${orderId}</span> is now in processing. Our team is preparing your items carefully.`,
    },

    shipped: {
      title: "Your order is on the way!",
      message: `Good news <span class='orange-clr'>${customerName}</span>!<br class='color-white'>Your order <span class='orange-clr'>${orderId}</span> has been shipped and is on its way to you.`,
    },

    delivered: {
      title: "Your order has been delivered!",
      message: `Hi <span class='orange-clr'>${customerName}</span>,<br class='color-white'>Your order <span class='orange-clr'>${orderId}</span> has been successfully delivered. We hope you love your purchase!`,
    },

    cancelled: {
      title: "Your order has been cancelled",
      message: `Hello <span class='orange-clr'>${customerName}</span>,<br class='color-white'>Your order <span class='orange-clr'>${orderId}</span> has been cancelled. If you did not request this, please contact support.`,
    },
  };

  const { title, message } = STATUS_MESSAGES[status];

  const exchangeRate = typeof items[0]?.exchange_rate === "number" ? items[0].exchange_rate : (items[0]?.exchange_rate != null ? Number(items[0].exchange_rate) : 1);
  const duty = Number(typeof duty_percent !== "undefined" ? duty_percent : 0) || 0;
  const displayPrice = (item) => {
    const p = (item.price || 0) * exchangeRate;
    return (duty > 0 ? p * (1 + duty / 100) : p).toFixed(2);
  };

  // ITEMS TABLE (with duty applied)
  const tableRows = items
    .map(
      (item) => `
        <tr>
          <td>
            <img src='${
              item.image
            }' crossOrigin='anonymous' style='width:100px; border-radius:15px;'><br>
          </td>
          <td><h4>${item.name}</h4></td>
          <td><h4>${item.qty}</h4></td>
          <td><h4>${currency} ${displayPrice(item)}</h4></td>
        </tr>`
    )
    .join("");

  // TEMPLATE
  return `
 <!DOCTYPE html>
<html lang='en'>
<head>
<meta charset='UTF-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
<style>
  body { font-family: Arial; color:white; margin:0; padding:0; background:#f4f4f4; }
  .container { width:600px; margin:20px auto; padding:20px; border-radius:10px; background:black; }
  .logo { width:240px; }
  table { width:100%; border-collapse:collapse; background:white; color:black; border-radius:15px; }
  td, th { padding:8px; }
  .orange-clr { color:#fbc95b; }
  h2, h3, h4 { margin:0; }
</style>
</head>

<body>
<center>
  <div class='container'>
    <center><img class='logo' src='https://www.aayeu.com/assets/images/aayeu_logo.png'></center>

    <h2 align='center' style='margin:0; color:white;'>${title}</h2>
<h3 align='center' style='margin:0; color:white;'>${message}</h3>


    <br>

    <center>
      <table>
        ${tableRows}
      </table>
    </center>

    <br>
  </div>
</center>
</body>
</html>`;
};
