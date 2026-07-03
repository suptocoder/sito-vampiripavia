<?
	include ("../db_connect.php");
	
	$id = $_POST['id'];
	$lvl = $_POST['lvl'];
	
	OpenConnection();

	$sql = "";
	$sql .= "UPDATE bacheca_argomenti SET pos = ".$lvl." ";
	$sql .= "WHERE id = ".$id;
	
	$query = mysql_query($sql);

	CloseConnection();
	
	header("Location: gest_bacheca.php");	
?>