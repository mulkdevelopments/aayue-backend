module.exports.generateOrderConfirmationEmail = ({
  customerName,
  orderId,
  items,
  currency = "€",
  duty_percent = 0,
}) => {
  // Validate input
  if (
    !customerName ||
    !orderId ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new Error(
      "Missing required parameters: customerName, orderId, and items array are required."
    );
  }
  const duty = Number(duty_percent) || 0;
  const rate = (item) => (item.exchange_rate != null ? Number(item.exchange_rate) : 1);
  const displayPrice = (item) => {
    const p = (item.price || 0) * rate(item);
    return (duty > 0 ? p * (1 + duty / 100) : p).toFixed(2);
  };
  // Generate table rows dynamically (with duty applied)
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
             <h4>${currency} ${displayPrice(item)}</h4>
            </td>
        </tr>`
    )
    .join("");

  // Full HTML Email Template
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
        .header {
            text-align: center;
            margin-bottom: 20px;
        }
        .header img {
            width: 240px;
        }
        .content p {
            margin-bottom: 15px;
        }
        .button {
            text-align: left;
            margin: 20px 0;
        }
        .button a {
            background-color: red;
            color: white;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 5px;
        }
        .footer {
            text-align: left;
            margin-top: 20px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            background: white;
            border-radius: 15px;
            color: black;
            border-spacing: 0px;
        }
        th, td { 
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #f2f2f2;
        }
        img {
            width: 100px;  
            border-radius: 15px;  
        }
        .logo {
            width: 240px; 
        }
        .margin-zero {
            margin: 0px;
            color: white !important;
        }
        .footera {
            color: white !important;
            text-decoration: none;
        }
        .orange-clr {
            color: #fbc95b;
        }
        h2, h3, h4 {
            margin: 0;
        }
    </style>
</head>
<body>
    <center>
        <div class='container'>
            <div class='content'>
                <center>
                    <img class='logo' crossOrigin='anonymous' src='https://www.aayeu.com/assets/images/aayeu-f-white.png' alt='Logo'>
                </center> 
                <h2 class='margin-zero' align='center'> 
                    Your order has been successfully received.
                </h2>
                <h3 class='margin-zero' align='center'>
                    Dear <span class='orange-clr'>${customerName},</span><br>
                    Thank you for your order <span class='orange-clr'>ID: ${orderId}</span>.
                </h3>
                <br>

                <center>
                    <table border='0'>  
                        ${tableRows}
                    </table>
                </center>
                <br> 
            </div> 
        </div>
    </center>
</body>
</html>`;
};
