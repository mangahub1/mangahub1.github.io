def generate_content_key(content_type, sequence_number):
    normalized_type = str(content_type or "").strip().upper()
    if not normalized_type:
        raise ValueError("content_type is required to generate content_key.")

    try:
        sequence = int(sequence_number)
    except (TypeError, ValueError) as exc:
        raise ValueError("sequence_number must be numeric to generate content_key.") from exc

    if sequence <= 0:
        raise ValueError("sequence_number must be greater than 0.")

    return f"{normalized_type}#{sequence:04d}"


def sanitize_for_s3(value):
    text = str(value or "").strip()
    return (
        text.replace("#", "_")
        .replace("/", "_")
        .replace("\\", "_")
        .replace(" ", "_")
        .lower()
    )
