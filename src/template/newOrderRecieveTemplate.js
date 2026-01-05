module.exports.generateAdminNewOrderEmail = ({
  customerName,
  customerEmail,
  customerPhone,
  orderId,
  items,
  currency = "€",
}) => {
  if (
    !customerName ||
    !orderId ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new Error("Missing required parameters for admin new order email.");
  }

  const tableRows = items
    .map(
      (item) => `
        <tr>
            <td>
                <img src='${item.image}' crossOrigin='anonymous' alt='${
        item.name
      }' style='width:100px; border-radius:15px;'><br> 
            </td>
            <td> 
                <h4>${item.name}</h4>
            </td>
            <td>
                <h4>${item.qty}</h4>
            </td>
            <td>
                <h4>${currency} ${parseFloat(item.price).toFixed(2)}</h4>
            </td>
        </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang='en'>
<head>
<meta charset='UTF-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
<style>
    body {
        font-family: Arial, sans-serif;
        line-height: 1.6;
        color: white !important;
        margin: 0;
        padding: 0;
        background-color: #f4f4f4;
    }
    .container {
        width: 600px;
        margin: 20px auto;
        padding: 20px;
        border: 1px solid black;
        border-radius: 10px;
        background-color: black;
    }
    .logo {
        width: 240px;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
        background: white;
        border-radius: 15px;
        color: black;
    }
    th, td { 
        padding: 8px;
        text-align: left;
    }
    th {
        background-color: #f2f2f2;
    }
    h2, h3, h4 {
        margin: 0;
    }
    .orange-clr {
        color: #fbc95b;
    }
    .margin-zero {
        margin: 0px;
        color: white !important;
    }
</style>
</head>

<body>
<center>
    <div class='container'>
        <center>
            <img class='logo' crossOrigin='anonymous' src='https://www.aayeu.com/assets/images/aayeu_logo.png' 
     alt='Logo' 
     style='width:240px; height:80px; object-fit:contain;'>

        </center>

        <h2 class='margin-zero' align='center'>
            🔔 New Order Received
        </h2>

        <h3 class='margin-zero' align='center'>
            Order ID: <span class='orange-clr'>${orderId}</span>
        </h3>

        <br>

        <h3 class='margin-zero'>Customer Details:</h3>
        <p class='margin-zero'>
            <strong>Name:</strong> ${customerName}<br>
            <strong>Email:</strong> ${customerEmail || "Not Provided"}<br>
            <strong>Phone:</strong> ${customerPhone || "Not Provided"}
        </p>

        <br>

        <center>
            <table border='0'>
                <tr>
                    <th>Image</th>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Price</th>
                </tr>
                ${tableRows}
            </table>
        </center>

        <br>
    </div>
</center>
</body>
</html>
`;
};
