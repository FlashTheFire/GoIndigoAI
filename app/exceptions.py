class AutomationError(Exception):
    """Base exception for the automation project."""
    pass

class APIError(AutomationError):
    """Raised when the API returns an error or unparseable response."""
    pass

class ValidationError(AutomationError):
    """Raised when parsing or validating data fails."""
    pass
