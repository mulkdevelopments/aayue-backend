const generateBarcode = require("../utils/generateBarcodeImage");

module.exports.generateInvoiceHTML = function (data) {
  const {
    orderId,
    orderDate,
    customer,
    company,
    items,
    subtotal,
    shipping,
    grandTotal,
    paymentStatus,
    currency_symbol = "€",
  } = data;
  const sym = currency_symbol || "€";

  const barcodeImage = generateBarcode(orderId);
  console.log(customer.address, "customer address");

  const formatAddress = (addr) => {
    if (!addr) return "Address not available";

    // Agar already string hai
    if (typeof addr === "string") {
      return addr.replace(/\n/g, "<br>");
    }

    // Agar object hai → manually format karo
    if (typeof addr === "object") {
      const parts = [];
      if (addr.street) parts.push(addr.street);
      if (addr.city) parts.push(addr.city);
      if (addr.state) parts.push(addr.state);
      if (addr.postal_code) parts.push(addr.postal_code);
      if (addr.country) parts.push(addr.country);

      return parts.length > 0 ? parts.join(", ") : "Address not available";
    }

    return "Address not available";
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${orderId}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @media print { body { @apply p-4; } }
  </style>
</head>
<body class="bg-white text-black font-sans text-sm leading-relaxed">

  <div class="max-w-4xl mx-auto p-10">

    <!-- Logo + INVOICE -->
  <div class="flex justify-end mb-8">
  <div class="text-3xl font-bold">INVOICE</div>
</div>

    <!-- From Section (Right Aligned) -->
    <div class="flex justify-end mb-10">
      <div class="w-80 text-left">
        <div class="flex items-start gap-3">
          <span class="text-gray-600 font-semibold text-sm pt-1">From</span>
          <span class="w-px h-28 bg-gray-400"></span>
          <div>
            <div class="font-bold text-base">${company.name}</div>
            <div class="text-sm leading-relaxed">
              Address: ${formatAddress(company.address)}<br>
              Email: <a href="mailto:${
                company.email
              }" class="text-blue-600 underline">${company.email}</a><br>
              Phone: ${company.phone}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TWO COLUMN LAYOUT: LEFT (Billed + Date) | RIGHT (Order ID + Barcode) -->
    <div class="grid grid-cols-2 gap-10 mb-10">
<table class="w-full text-sm">
  <tbody>

    <!-- Billed/Shipped To Row -->
    <tr>
      <td class="align-top pr-4 py-1">
        <span class="text-gray-600 font-semibold whitespace-nowrap">Billed/Shipped To,</span>
      </td>
      <td class="align-top py-1 ">
        <div class="w-px h-24 bg-gray-400"></div>
      </td>
      <td class="align-top py-1 pl-3">
        <div class="font-bold text-base">${customer.name}</div>
        <div class="text-sm leading-relaxed">
          ${formatAddress(customer.address)}<br>
          ${customer.email}<br>+${customer.phone}
        </div>
      </td>
    </tr>

    <!-- Order Date Row -->
    <tr>
      <td class="align-top pr-4 py-1">
        <span class="text-gray-600 font-semibold whitespace-nowrap">Order Date</span>
      </td>
      <td class="align-top py-1 w-px">
        <div class="w-px h-6 bg-gray-400"></div>
      </td>
      <td class="align-top py-1 pl-5">
        <span class="font-bold text-base">${orderDate}</span>
      </td>
    </tr>

  </tbody>
</table>

      <!-- RIGHT: Order ID + Barcode -->
      <div class="flex justify-end">
       <div class="text-right">
  <!-- Order ID with | divider -->
  <div class="flex items-center justify-start gap-3 text-sm">
    <span class="text-gray-600 font-semibold">Order ID</span>
    <span class="w-px h-6 bg-gray-400"></span>
    <span class="font-bold text-base">${orderId}</span>
  </div>

  <!-- Barcode below -->
  <div class="inline-block py-2 text-center mt-2">
    <img src="${barcodeImage}" alt="Barcode" class="h-20 mx-auto" />
  </div>
</div>
      </div>

    </div>

    <!-- Items Table -->
    <table class="w-full border-collapse my-10 text-sm">
      <thead>
        <tr class="bg-gray-100">
          <th class="border border-gray-300 px-3 py-2 text-left font-semibold text-gray-700">SKU#</th>
          <th class="border border-gray-300 px-3 py-2 text-left font-semibold text-gray-700">Description</th>
          <th class="border border-gray-300 px-3 py-2 text-center font-semibold text-gray-700">Quantity</th>
          <th class="border border-gray-300 px-3 py-2 text-center font-semibold text-gray-700">Size</th>
          <th class="border border-gray-300 px-3 py-2 text-right font-semibold text-gray-700">Unit Price</th>
          <th class="border border-gray-300 px-3 py-2 text-right font-semibold text-gray-700">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (item, i) => `
          <tr class="${i % 2 === 1 ? "bg-gray-50" : ""}">
            <td class="border border-gray-300 px-3 py-3">${item.sku}</td>
            <td class="border border-gray-300 px-3 py-3">${
              item.product_name
            }</td>
            <td class="border border-gray-300 px-3 py-3 text-center">${
              item.qty
            }</td>
            <td class="border border-gray-300 px-3 py-3 text-center">${
              item.size || "-"
            }</td>
            <td class="border border-gray-300 px-3 py-3 text-right">${sym} ${
              item.unitPrice
            }</td>
            <td class="border border-gray-300 px-3 py-3 text-right font-bold">${sym} ${
              item.total
            }</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>

    <!-- Summary -->
    <div class="float-right w-72 mt-6 text-sm">
      <div class="flex justify-between py-1">
        <span>Cart Subtotal</span>
        <span class="font-bold">${sym} ${subtotal}</span>
      </div>
      <div class="flex justify-between py-1">
        <span>Shipping</span>
        <span>${sym} ${shipping}</span>
      </div>
      <div class="flex justify-between py-1 border-t border-gray-300 pt-3 mt-3 font-bold text-base">
        <span>Grand Total</span>
        <span>${sym} ${grandTotal}</span>
      </div>
      <div class="text-right text-red-600 text-3xl font-bold mt-4">${
        paymentStatus ? (paymentStatus == "paid" ? "PAID" : "PENDING") : ""
      }</div>
    </div>
    <div class="clear-both"></div>

  </div>

</body>
</html>`;
};
