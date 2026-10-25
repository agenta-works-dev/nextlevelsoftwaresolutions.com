export const purchaseOrder = Object.freeze({
  quantity: 120,
  unitPrice: 24,
  delivery: "2026-11-18",
});
export const acknowledgementExamples = Object.freeze({
  differences: Object.freeze({
    quantity: 100,
    unitPrice: 24,
    delivery: "2026-11-24",
  }),
  matching: Object.freeze({ ...purchaseOrder }),
});

export function compareOrder(order, acknowledgement) {
  const changes = [];
  if (order.quantity !== acknowledgement.quantity) {
    const difference = acknowledgement.quantity - order.quantity;
    changes.push({
      field: "quantity",
      label:
        difference < 0
          ? `${Math.abs(difference)} fewer units`
          : `${difference} additional units`,
    });
  }
  if (order.unitPrice !== acknowledgement.unitPrice) {
    const difference = acknowledgement.unitPrice - order.unitPrice;
    changes.push({
      field: "unitPrice",
      label: `$${Math.abs(difference).toFixed(2)} ${difference < 0 ? "lower" : "higher"} per unit`,
    });
  }
  if (order.delivery !== acknowledgement.delivery) {
    const days = Math.round(
      (Date.parse(acknowledgement.delivery) - Date.parse(order.delivery)) /
        86400000,
    );
    changes.push({
      field: "delivery",
      label: `${Math.abs(days)} days ${days < 0 ? "earlier" : "later"}`,
    });
  }
  return changes;
}
