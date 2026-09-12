"""Pure contracts for the isolated Svelte H3 review workspace."""

H3_LENGTH_BASE = 5
H3_LENGTH_STRIDE = 17
H3_LENGTH_MAX = 3592


def is_valid_retry_length(value):
    """Return whether *value* is 0 or an H3-native frame length (17k+5)."""
    if isinstance(value, bool):
        return False
    try:
        number = int(value)
    except (TypeError, ValueError):
        return False
    if number != value:
        return False
    return number == 0 or (
        H3_LENGTH_BASE <= number <= H3_LENGTH_MAX
        and (number - H3_LENGTH_BASE) % H3_LENGTH_STRIDE == 0
    )


def validate_retry_length(value):
    """Normalize an integer input and reject invalid model frame lengths."""
    if not is_valid_retry_length(value):
        raise ValueError("retry_length must be 0 or 17k+5 (5, 22, 39, ... 3592)")
    return int(value)
