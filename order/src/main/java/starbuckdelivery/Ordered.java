package starbuckdelivery;


public class Ordered extends AbstractEvent {

    private Long id;
    private String orderId;
    private String productId;
    private String address;
    private String option;

    public Ordered(){
        super();
    }

    public Long getId() {
        return id;
    }

    public void setId(Long Id) {
        this.id = id;
    }
    public String getOrderId() {
        return orderId;
    }

    public void setOrderId(String OrderId) {
        this.orderId = orderId;
    }
    public String getProductId() {
        return productId;
    }

    public void setProductId(String ProductId) {
        this.productId = productId;
    }
    public String getAddress() {
        return address;
    }

    public void setAddress(String Address) {
        this.address = address;
    }
    public String getOption() {
        return option;
    }

    public void setOption(String Option) {
        this.option = option;
    }
}
