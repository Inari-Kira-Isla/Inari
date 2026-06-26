-- A2: Order Fulfillment Trigger
-- Fires BEFORE UPDATE on inari_customer_orders
-- When status transitions to 'confirmed':
--   → calls inventory_pick_fefo() for each order item
--   → on stock shortage: reverts status to 'stock_alert' + appends note
--   → on success: stamps confirmed_at
-- Idempotency: order_no + product_code key prevents double-pick on retry

CREATE OR REPLACE FUNCTION fn_order_fulfillment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_item         RECORD;
  v_result       JSON;
  v_success      BOOLEAN;
  v_stock_issues TEXT[] := '{}';
  v_idempotency  TEXT;
BEGIN
  -- Only act on draft/pending → confirmed transition
  IF NEW.status <> 'confirmed' OR OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Loop every order item that has a product_code
  FOR v_item IN
    SELECT product_code, qty, product_name
    FROM   inari_customer_order_items
    WHERE  order_id = NEW.id
      AND  product_code IS NOT NULL
      AND  qty IS NOT NULL AND qty > 0
  LOOP
    -- Idempotency key prevents double-deduction on retry
    v_idempotency := NEW.order_no || '-' || v_item.product_code;

    BEGIN
      v_result := inventory_pick_fefo(
        p_tenant_id       => NEW.tenant_id,
        p_sku             => v_item.product_code,
        p_qty             => v_item.qty,
        p_reference_type  => 'order',
        p_reference_id    => NEW.id,
        p_reference_no    => NEW.order_no,
        p_notes           => '訂單確認自動扣庫存',
        p_user            => 'system',
        p_idempotency_key => v_idempotency
      );
      v_success := COALESCE((v_result->>'success')::BOOLEAN, false);
    EXCEPTION WHEN OTHERS THEN
      -- Catch any unexpected error; don't let it blow up the whole transaction
      v_success := false;
      v_result  := json_build_object('message', SQLERRM);
    END;

    IF NOT v_success THEN
      v_stock_issues := array_append(
        v_stock_issues,
        v_item.product_code || ' (' || COALESCE(v_item.product_name, '') || '): '
          || COALESCE(v_result->>'message', '庫存不足')
      );
    END IF;
  END LOOP;

  -- Outcome
  IF array_length(v_stock_issues, 1) > 0 THEN
    -- Revert to stock_alert so staff can resolve manually
    NEW.status := 'stock_alert';
    NEW.notes  := COALESCE(NEW.notes || E'\n', '')
                  || '[庫存警示 ' || NOW()::date || '] '
                  || array_to_string(v_stock_issues, ' | ');
  ELSE
    -- All items picked successfully
    NEW.confirmed_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any (idempotent migration)
DROP TRIGGER IF EXISTS trg_order_fulfillment ON inari_customer_orders;

CREATE TRIGGER trg_order_fulfillment
  BEFORE UPDATE ON inari_customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_order_fulfillment();

-- Add stock_alert to status check constraint
ALTER TABLE inari_customer_orders DROP CONSTRAINT IF EXISTS inari_customer_orders_status_check;
ALTER TABLE inari_customer_orders ADD CONSTRAINT inari_customer_orders_status_check
  CHECK (status = ANY (ARRAY['draft','confirmed','invoiced','cancelled','stock_alert']));

-- Verify
SELECT tgname, tgenabled FROM pg_trigger
WHERE  tgname = 'trg_order_fulfillment';
