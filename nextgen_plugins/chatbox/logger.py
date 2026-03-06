import logging
import os


class _DebugOnlyFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno == logging.DEBUG

def _configure_logger() -> logging.Logger:
    logger = logging.getLogger("nrds.client")
    if logger.handlers:
        return logger

    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))

    debug_only = os.getenv("NRDS_LOG_DEBUG_ONLY", "0").lower() in {"1", "true", "yes", "on"}
    if debug_only:
        logger.setLevel(logging.DEBUG)
        handler.setLevel(logging.DEBUG)
        handler.addFilter(_DebugOnlyFilter())
    else:
        level_name = os.getenv("NRDS_LOG_LEVEL", "INFO").upper()
        level_value = getattr(logging, level_name, logging.INFO)
        logger.setLevel(level_value)
        handler.setLevel(level_value)

    logger.addHandler(handler)
    logger.propagate = False
    return logger


LOGGER = _configure_logger()